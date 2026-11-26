// Rates, commodities, the dollar and Bitcoin (macro.json): a strip of cards on the Markets page and the
// Daily Brief. Starts from the saved file and switches to live prices when the price service is on.
(function () {
  const { esc, spark } = UI;
  // The 10-year yield moves in basis points (hundredths of a percent); everything else in %
  const isYield = (m) => m.unit === "%";
  const level = (m) => {
    if (m.p == null) return "–";
    const nd = m.unit === "pts" || isYield(m) || m.unit === "C$" ? (m.p >= 1000 ? 0 : m.unit === "C$" ? 4 : 2) : m.p >= 1000 ? 0 : 2;
    const v = m.p.toLocaleString(undefined, { minimumFractionDigits: nd, maximumFractionDigits: nd });
    return isYield(m) ? v + "%" : m.unit === "$" ? "$" + v : m.unit === "C$" ? "C$" + v : v;
  };
  const move = (m, key = "d1") => {
    if (isYield(m) && key === "d1" && m.p != null && m.pc != null) {
      const bp = Math.round((m.p - m.pc) * 100);
      return `<span class="num ${bp >= 0 ? "up" : "down"}" title="Change in basis points (hundredths of a percentage point)">${bp >= 0 ? "+" : ""}${bp} bp</span>`;
    }
    return UI.pct(m[key], 2);
  };

  function card(m) {
    return `<a class="macro-card" href="${UI.stockUrl(m.t)}" title="${esc(m.why || m.n)}">
      <span class="mc-name">${esc(m.s)}</span>
      <span class="mc-level num">${level(m)}</span>
      <span class="mc-moves">${move(m)}<span class="muted"> · 1W </span>${UI.pct(m.w1, 1)}</span>
      ${spark(m.spark, 84, 22)}
    </a>`;
  }

  async function render(el) {
    let d;
    try { d = await UI.load("macro.json"); } catch (e) { el.hidden = true; return; }
    const items = (d.items || []).filter((m) => m.p != null);
    if (!items.length) { el.hidden = true; return; }
    const draw = () => {
      el.innerHTML = `<div class="macro-head"><h2>Rates, commodities and crypto</h2>
        <p class="hint">What moves the whole market. Tap one for its chart, hover for what it means.</p></div>
        <div class="macro-row">${items.map(card).join("")}</div>`;
    };
    draw();
    el.hidden = false;
    if (window.Live && Live.on) {
      Live.every(60000, async () => {
        const q = await Live.quotes(items.map((m) => m.t));
        let changed = false;
        for (const m of items) {
          const y = q[m.t];
          if (y && y.price != null) {
            m.p = y.price;
            if (y.prevClose) { m.pc = y.prevClose; m.d1 = (y.price / y.prevClose - 1) * 100; }
            changed = true;
          }
        }
        if (changed) draw();
      });
    }
  }

  // One plain sentence for the Daily Brief
  function sentence(items) {
    const by = Object.fromEntries(items.map((m) => [m.t, m]));
    const bits = [];
    const vix = by["^VIX"], tnx = by["^TNX"], oil = by["CL=F"], gold = by["GC=F"], btc = by["BTC-USD"];
    if (vix && vix.p != null) bits.push(`the VIX is at ${vix.p.toFixed(1)} (${vix.p < 15 ? "calm" : vix.p < 20 ? "normal" : vix.p < 30 ? "nervous" : "fearful"})`);
    if (tnx && tnx.p != null) bits.push(`the US 10-year yield is ${tnx.p.toFixed(2)}%${tnx.pc != null ? `, ${tnx.p >= tnx.pc ? "up" : "down"} ${Math.abs(Math.round((tnx.p - tnx.pc) * 100))} bp on the day` : ""}`);
    if (oil && oil.d1 != null) bits.push(`oil ${oil.d1 >= 0 ? "rose" : "fell"} ${Math.abs(oil.d1).toFixed(1)}% to $${oil.p.toFixed(2)}`);
    if (gold && gold.d1 != null) bits.push(`gold ${gold.d1 >= 0 ? "rose" : "fell"} ${Math.abs(gold.d1).toFixed(1)}%`);
    if (btc && btc.d1 != null) bits.push(`Bitcoin is ${btc.d1 >= 0 ? "up" : "down"} ${Math.abs(btc.d1).toFixed(1)}% at $${Math.round(btc.p).toLocaleString()}`);
    if (!bits.length) return "";
    const s = bits.join(", ");
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }

  window.Macro = { render, sentence, level, move };
  const el = document.getElementById("macro");
  if (el) render(el);
})();
