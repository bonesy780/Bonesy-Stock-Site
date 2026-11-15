// Home page: pick stocks or real estate, with a glance at each side's latest figures.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const chg = (v) => v == null ? "" : `<i class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)}%</i>`;
  const remember = document.getElementById("remember");
  for (const a of document.querySelectorAll("[data-pick]")) {
    a.addEventListener("click", () => {
      try { if (remember.checked) localStorage.setItem("home-pick", a.dataset.pick); else localStorage.removeItem("home-pick"); } catch {}
    });
  }
  try { remember.checked = !!localStorage.getItem("home-pick"); } catch {}
  remember.addEventListener("change", () => { if (!remember.checked) try { localStorage.removeItem("home-pick"); } catch {} });

  const NAMES = { sp500: "S&P 500", nasdaq100: "Nasdaq", dow: "Dow", tsx: "TSX", nikkei225: "Nikkei" };
  fetch("tape.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => {
    const ix = ((d && d.items) || []).filter((x) => x.ix && NAMES[x.ix]).slice(0, 4);
    if (ix.length) document.getElementById("live-stocks").innerHTML = ix.map((x) =>
      `<span><b>${esc(NAMES[x.ix])}</b> <span class="num">${x.p.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> ${chg(x.c)}</span>`).join("");
  }).catch(() => {});
  fetch("re/data.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => {
    if (!d) return;
    const us = d.markets.find((m) => m.id === "us"), R = d.rates || {};
    const bits = [];
    if (us && us.v) bits.push(`<span><b>US home</b> <span class="num">$${Math.round(us.v / 1000)}K</span> ${chg(us.v1y)}</span>`);
    if (R.us30) bits.push(`<span><b>US 30-yr</b> <span class="num">${R.us30.v.toFixed(2)}%</span></span>`);
    if (R.ca5) bits.push(`<span><b>Canada 5-yr</b> <span class="num">${R.ca5.v.toFixed(2)}%</span></span>`);
    document.getElementById("live-re").innerHTML = bits.join("");
  }).catch(() => {});
})();
