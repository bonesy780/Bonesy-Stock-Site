// Light or dark on wider screens: follows the device until the reader picks one with the header button.
// Phone-size screens are always dark. A small script in each page's <head> applies the saved choice before
// the page paints; this file adds the button and keeps the choice in step when the window is resized.
// It also adds a "back to top" button that appears after scrolling down a long page.
(function () {
  const root = document.documentElement;
  const narrow = matchMedia("(max-width: 640px)");
  const osDark = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => { try { return localStorage.getItem("theme"); } catch { return null; } };
  const save = (v) => { try { v ? localStorage.setItem("theme", v) : localStorage.removeItem("theme"); } catch {} };
  const dark = () => narrow.matches || (root.dataset.theme ? root.dataset.theme === "dark" : osDark.matches);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-btn";
  const MOON = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const SUN = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function sync() {
    const d = dark();
    btn.innerHTML = d ? SUN : MOON;
    btn.title = d ? "Switch to the light theme" : "Switch to the dark theme";
    btn.setAttribute("aria-label", btn.title);
  }
  function apply() {
    const t = saved();
    if (t && !narrow.matches) root.dataset.theme = t; else delete root.dataset.theme;
    sync();
  }
  btn.addEventListener("click", () => {
    const next = dark() ? "light" : "dark";
    // Picking what the device already uses means "follow the device" again
    save(next === (osDark.matches ? "dark" : "light") ? null : next);
    if (next === (osDark.matches ? "dark" : "light")) delete root.dataset.theme; else root.dataset.theme = next;
    sync();
  });
  narrow.addEventListener("change", apply);
  osDark.addEventListener("change", sync);
  window.addEventListener("storage", (e) => { if (e.key === "theme") apply(); });

  function place() {
    const home = document.querySelector(".hm-head");
    const bar = document.querySelector(".top-inner");
    if (home) home.appendChild(btn);
    else if (bar) bar.appendChild(btn);
    else return;
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place); else place();
  // ---- back to top, once the reader is well down a long page
  const top = document.createElement("button");
  top.type = "button";
  top.className = "to-top";
  top.hidden = true;
  top.setAttribute("aria-label", "Back to top");
  top.title = "Back to top";
  top.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  top.addEventListener("click", () => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
    const skip = document.querySelector(".skip");
    if (skip) skip.focus({ preventScroll: true });
  });
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { top.hidden = window.scrollY < window.innerHeight * 1.5; ticking = false; });
  }, { passive: true });
  const addTop = () => document.body.appendChild(top);
  if (document.body) addTop(); else document.addEventListener("DOMContentLoaded", addTop);
})();
