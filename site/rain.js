// Matrix-style rain of digits and tickers in the empty space beside the content
window.startRain = function (words) {
  // Mostly tickers, with a few loose digits and symbols mixed in
  const tickers = (words || []).filter((t) => /^[A-Z][A-Z.]{0,5}$/.test(t));
  const glyphs = tickers.length ? tickers.concat("0123456789$%+-".split("").slice(0, Math.ceil(tickers.length / 8))) : "0123456789$%+-.".split("");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll(".side-art").forEach((el) => {
    const cv = document.createElement("canvas");
    el.appendChild(cv);
    const ctx = cv.getContext("2d");
    const size = 15;
    let cols = [], w = 0, h = 0;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Array.from({ length: Math.ceil(w / size) }, () => ({ y: Math.random() * -h, speed: 0.6 + Math.random() * 1.2, word: "", i: 0 }));
      ctx.fillStyle = "#010a03"; ctx.fillRect(0, 0, w, h);
    };
    const draw = () => {
      ctx.fillStyle = "rgba(1, 10, 3, 0.12)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = `500 ${size - 2}px "JetBrains Mono", monospace`;
      cols.forEach((c, n) => {
        if (!c.word || c.i >= c.word.length) { c.word = glyphs[Math.floor(Math.random() * glyphs.length)]; c.i = 0; }
        const ch = c.word[c.i++];
        ctx.fillStyle = Math.random() < 0.08 ? "#d8ffe4" : "#20e070";
        ctx.fillText(ch, n * size, c.y);
        c.y += size * c.speed;
        if (c.y > h + size && Math.random() > 0.96) c.y = Math.random() * -200;
      });
    };
    fit();
    window.addEventListener("resize", fit);
    if (still) { for (let k = 0; k < 120; k++) draw(); return; }
    let last = 0;
    const loop = (t) => { if (t - last > 55 && w) { draw(); last = t; } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });

};
