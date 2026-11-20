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
    // Drop any quote without a real price, so a bad answer never shows as $0 or a -100% day
    for (const [k, q] of Object.entries(out)) {
      if (!q || !(Number.isFinite(q.price) && q.price > 0)) { delete out[k]; continue; }
      if (!(Number.isFinite(q.prevClose) && q.prevClose > 0)) { q.prevClose = null; q.chg1d = null; }
      else if (!Number.isFinite(q.chg1d)) q.chg1d = (q.price / q.prevClose - 1) * 100;
    }
    return out;
  }

  async function chart(symbol, range) {
    const res = await fetch(`${API}/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
    if (!res.ok) throw new Error("chart " + res.status);
    return res.json();
  }

  // Every daily close plus the last 5 days of 5-minute prices, for a stock without a saved file
  async function history(symbol) {
    const res = await fetch(`${API}/history?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error("history " + res.status);
    return res.json();
  }

  // Stocks and funds anywhere that match a name or symbol: [{ t, n, x, type }]
  async function search(q) {
    const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const out = await res.json();
    return Array.isArray(out) ? out : [];
  }

  // Run fn now and every `ms` while the tab is visible
  // (One refresh at a time: coming back to the tab while a refresh is still loading used to start a second
  // loop, doubling the requests every time it happened.)
  function every(ms, fn) {
    let timer = null, busy = false;
    const tick = async () => {
      clearTimeout(timer);
      if (busy) return;
      busy = true;
      try { await fn(); } catch (e) { /* keep what is shown and try again next time */ } finally {
        busy = false;
        clearTimeout(timer);
        if (!document.hidden) timer = setTimeout(tick, ms);
      }
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); else clearTimeout(timer); });
    tick();
  }

  const stamp = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

  window.Live = { on, api: on ? API : null, quotes, chart, history, search, every, stamp };
})();
