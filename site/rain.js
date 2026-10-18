// Matrix-style rain of digits and tickers in the empty space beside the content
window.startRain = function (words) {
  // Mostly tickers, with a few loose digits and symbols mixed in
  const tickers = (words || []).filter((t) => /^[A-Z][A-Z.]{0,5}$/.test(t));
  const filler = "0123456789$%+-".split("");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll(".side-art").forEach((el) => {
    const cv = document.createElement("canvas");
    el.appendChild(cv);
    const ctx = cv.getContext("2d");
    const size = 20;
    let cols = [], w = 0, h = 0;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Array.from({ length: Math.ceil(w / size) }, () => ({ y: Math.random() * -h, speed: 0.5 + Math.random() * 0.5, word: "", i: 0, isTicker: false }));
      ctx.fillStyle = "#010a03"; ctx.fillRect(0, 0, w, h);
    };
    const draw = () => {
      ctx.fillStyle = "rgba(1, 10, 3, 0.08)";
      ctx.fillRect(0, 0, w, h);
      cols.forEach((c, n) => {
        if (!c.word || c.i >= c.word.length) {
          // Mostly stock tickers, with the odd loose digit between them
          c.isTicker = tickers.length && Math.random() < 0.8;
          c.word = c.isTicker ? tickers[Math.floor(Math.random() * tickers.length)] : filler[Math.floor(Math.random() * filler.length)];
          c.i = 0;
        }
        const ch = c.word[c.i++];
        if (c.isTicker) {
          ctx.font = `700 ${size - 2}px "JetBrains Mono", monospace`;
          ctx.fillStyle = c.i === 1 ? "#eafff0" : "#3dff8a";
          ctx.shadowColor = "#20e070"; ctx.shadowBlur = 8;
        } else {
          ctx.font = `500 ${size - 6}px "JetBrains Mono", monospace`;
          ctx.fillStyle = "#0f8a3c";
          ctx.shadowBlur = 0;
        }
        ctx.fillText(ch, n * size + 2, c.y);
        ctx.shadowBlur = 0;
        c.y += size * c.speed;
        if (c.y > h + size && Math.random() > 0.9) c.y = Math.random() * -200;
      });
    };
    fit();
    window.addEventListener("resize", fit);
    if (still) { for (let k = 0; k < 120; k++) draw(); return; }
    let last = 0;
    const loop = (t) => { if (t - last > 88 && w) { draw(); last = t; } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });

};
