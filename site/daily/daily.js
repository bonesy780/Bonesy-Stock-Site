// Daily News: the day's headlines from about 90 outlets, with genre, region, state and province toggles,
// big stories grouped across outlets, a two-minute briefing, a random pick, saved stories and read tracking.
(async function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const $ = (id) => document.getElementById(id);
  const feedEl = $("dn-feed");

  // ---- greeting (the reader's own clock)
  const now = new Date();
  const hr = now.getHours();
  $("dn-hello").textContent = hr < 5 ? "Up late? Here's the world" : hr < 12 ? "Good morning ☀️" : hr < 17 ? "Good afternoon 👋" : "Good evening 🌙";
  $("dn-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  let D;
  try {
    const r = await fetch("news.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
  } catch {
    $("dn-sub").textContent = "";
    feedEl.innerHTML = `<div class="panel empty">The news hasn't been gathered yet. It refreshes every morning and evening; check back soon.</div>`;
    $("updated").textContent = "";
    return;
  }

  const S0 = D.stories.map((s, i) => ({ ...s, i, ts: Date.parse(s.at) }));
  const GEN = Object.fromEntries(D.genres.map((g) => [g.id, g]));
  const OUT = Object.fromEntries(D.outlets.map((o) => [o.id, o]));
  const PLACE = { ...D.provinces, ...D.states };
  const REGION_G = new Set(["world", "us", "canada"]);
  const ago = (ts) => {
    const m = (Date.now() - ts) / 6e4;
    return m < 2 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const gen = new Date(D.generated);
  $("updated").textContent = `Updated ${gen.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${gen.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const liveOutlets = D.outlets.filter((o) => o.n).length;
  $("dn-sub").textContent = `${S0.length.toLocaleString()} stories from ${liveOutlets} outlets and hundreds of local papers, past 48 hours. Pick what you care about below; your choices are remembered on this device.`;
  if (D.missing && D.missing.length) $("dn-missing").textContent = `Nothing came through this time from: ${D.missing.join(", ")}.`;

  // ---- reader state (kept in this browser)
  const today = now.toISOString().slice(0, 10);
  const readLog = store.get("dn-read", {});
  for (const k of Object.keys(readLog)) if (Date.now() - readLog[k] > 4 * 864e5) delete readLog[k];
  const read = new Set(Object.keys(readLog));
  const saved = store.get("dn-saved", []); // saved stories are kept whole, so they outlive the 48-hour window
  const lastVisit = store.get("dn-last-visit", 0);
  store.set("dn-last-visit", Date.now());
  const S = {
    region: store.get("dn-region", "all"), place: store.get("dn-place", ""), genres: new Set(store.get("dn-genres", [])),
    hours: store.get("dn-hours", 24), sort: store.get("dn-sort", "mix"), view: store.get("dn-view", "cards"),
    hideRead: store.get("dn-hide-read", false), off: new Set(store.get("dn-off", [])), q: "", tab: "all", n: 30,
  };
  const save = () => {
    store.set("dn-region", S.region); store.set("dn-place", S.place); store.set("dn-genres", [...S.genres]); store.set("dn-hours", S.hours);
    store.set("dn-sort", S.sort); store.set("dn-view", S.view); store.set("dn-hide-read", S.hideRead); store.set("dn-off", [...S.off]);
  };
  const markRead = (u) => {
    if (read.has(u)) return;
    read.add(u); readLog[u] = Date.now(); store.set("dn-read", readLog);
    const day = store.get("dn-day", {});
    if (day.d !== today) { day.d = today; day.n = 0; }
    day.n++; store.set("dn-day", day);
    ring();
  };
  const isSaved = (u) => saved.some((x) => x.u === u);
  const toggleSave = (s) => {
    const i = saved.findIndex((x) => x.u === s.u);
    if (i >= 0) saved.splice(i, 1); else saved.unshift({ t: s.t, u: s.u, s: s.s, o: s.o, at: s.at, sum: s.sum, img: s.img, g: s.g, geo: s.geo });
    store.set("dn-saved", saved.slice(0, 200));
    toast(i >= 0 ? "Removed from saved" : "Saved for later ★");
    return i < 0;
  };
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    $("dn-toast").appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  // Daily reading ring: stories opened today out of a goal of 10
  function ring() {
    const day = store.get("dn-day", {});
    const n = day.d === today ? day.n : 0, goal = 10, f = Math.min(1, n / goal), c = 2 * Math.PI * 18;
    $("dn-ring").innerHTML = `<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="ring-bg"/><circle cx="22" cy="22" r="18" class="ring-fg" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 22 22)"/></svg><span><b>${n}</b>/${goal} read today${n >= goal ? " 🎉" : ""}</span>`;
  }
  ring();

  // ---- filters
  const REGIONS = [["all", "🌐 Everywhere", "🌐 All"], ["world", "🌍 World"], ["us", "🇺🇸 United States", "🇺🇸 U.S."], ["canada", "🇨🇦 Canada"]];
  const TIMES = [[3, "3h"], [12, "12h"], [24, "24h"], [48, "48h"]];
  const inRegion = (s, r) => r === "all" || s.g.includes(r) || (r === "us" ? s.geo.some((p) => p.startsWith("US-")) : r === "canada" ? s.geo.some((p) => p.startsWith("CA-")) : false);
  const base = (s) => !S.off.has(s.o) && Date.now() - s.ts <= S.hours * 36e5 && (!S.hideRead || !read.has(s.u));
  const textOk = (s) => !S.q || (s.t + " " + s.s + " " + (s.sum || "")).toLowerCase().includes(S.q);
  const pool = () => S.tab === "saved" ? saved.map((s, i) => ({ ...s, i: "s" + i, ts: Date.parse(s.at) })) : S0;

  function current({ ignoreGenre = false, ignorePlace = false, ignoreRegion = false } = {}) {
    return pool().filter((s) => (S.tab === "saved" || base(s)) && textOk(s)
      && (ignoreRegion || inRegion(s, S.region))
      && (ignorePlace || !S.place || s.geo.includes(S.place))
      && (ignoreGenre || !S.genres.size || s.g.some((g) => S.genres.has(g))));
  }

  // Spread the outlets out: newest first, but no outlet twice in a row while others are waiting
  function mix(list) {
    const by = new Map();
    for (const s of list) { if (!by.has(s.o)) by.set(s.o, []); by.get(s.o).push(s); }
    const out = [];
    const queues = [...by.values()];
    while (queues.some((q) => q.length)) {
      const round = queues.filter((q) => q.length).map((q) => q.shift()).sort((a, b) => b.ts - a.ts);
      out.push(...round);
    }
    // Then keep it roughly in time order: stories within the same three hours stay mixed
    const bucket = (s) => Math.floor(s.ts / 108e5);
    return out.sort((a, b) => bucket(b) - bucket(a));
  }

  // ---- tile maps for states and provinces
  const US_TILES = [["AK", 0, 0], ["ME", 10, 0], ["WI", 5, 1], ["VT", 9, 1], ["NH", 10, 1],
    ["WA", 0, 2], ["ID", 1, 2], ["MT", 2, 2], ["ND", 3, 2], ["MN", 4, 2], ["IL", 5, 2], ["MI", 6, 2], ["NY", 8, 2], ["MA", 9, 2],
    ["OR", 0, 3], ["NV", 1, 3], ["WY", 2, 3], ["SD", 3, 3], ["IA", 4, 3], ["IN", 5, 3], ["OH", 6, 3], ["PA", 7, 3], ["NJ", 8, 3], ["CT", 9, 3], ["RI", 10, 3],
    ["CA", 0, 4], ["UT", 1, 4], ["CO", 2, 4], ["NE", 3, 4], ["MO", 4, 4], ["KY", 5, 4], ["WV", 6, 4], ["VA", 7, 4], ["MD", 8, 4], ["DE", 9, 4],
    ["AZ", 1, 5], ["NM", 2, 5], ["KS", 3, 5], ["AR", 4, 5], ["TN", 5, 5], ["NC", 6, 5], ["SC", 7, 5], ["DC", 8, 5],
    ["OK", 3, 6], ["LA", 4, 6], ["MS", 5, 6], ["AL", 6, 6], ["GA", 7, 6], ["HI", 0, 7], ["TX", 3, 7], ["FL", 8, 7]].map(([a, x, y]) => ["US-" + a, a, x, y]);
  const CA_TILES = [["YT", 0, 0], ["NT", 1, 0], ["NU", 2, 0], ["BC", 0, 1], ["AB", 1, 1], ["SK", 2, 1], ["MB", 3, 1], ["ON", 4, 1], ["QC", 5, 1], ["NL", 6, 1],
    ["NB", 5, 2], ["PE", 6, 2], ["NS", 7, 2]].map(([a, x, y]) => ["CA-" + a, a, x, y]);

  function drawMap() {
    const m = $("dn-map");
    if (S.region !== "us" && S.region !== "canada") { m.hidden = true; return; }
    m.hidden = false;
    const tiles = S.region === "us" ? US_TILES : CA_TILES;
    const list = current({ ignorePlace: true });
    const count = {};
    for (const s of list) for (const p of s.geo) count[p] = (count[p] || 0) + 1;
    const max = Math.max(1, ...tiles.map((t) => count[t[0]] || 0));
    const cols = Math.max(...tiles.map((t) => t[2])) + 1, rows = Math.max(...tiles.map((t) => t[3])) + 1;
    const opts = tiles.slice().sort((a, b) => PLACE[a[0]].localeCompare(PLACE[b[0]]));
    m.innerHTML = `<div class="dn-map-head"><b>${S.region === "us" ? "Pick a state" : "Pick a province or territory"}</b>
        <select class="field" id="dn-place" aria-label="${S.region === "us" ? "State" : "Province"}"><option value="">All ${S.region === "us" ? "states" : "provinces and territories"}</option>
        ${opts.map(([k]) => `<option value="${k}" ${k === S.place ? "selected" : ""}>${esc(PLACE[k])} (${count[k] || 0})</option>`).join("")}</select>
        ${S.place ? `<button class="chip" type="button" data-place="">✕ ${esc(PLACE[S.place])}</button>` : ""}</div>
      <div class="dn-tiles ${S.region}" style="--cols:${cols};--rows:${rows}">${tiles.map(([k, a, x, y]) => {
        const n = count[k] || 0;
        return `<button type="button" class="dn-tile${n / max > 0.5 ? " hot" : ""}" data-place="${k}" aria-pressed="${k === S.place}" style="grid-column:${x + 1};grid-row:${y + 1};--heat:${(n / max).toFixed(2)}" title="${esc(PLACE[k])}: ${n} ${n === 1 ? "story" : "stories"}"><b>${a}</b><i>${n || ""}</i></button>`;
      }).join("")}</div>`;
  }

  function drawGenres() {
    const list = current({ ignoreGenre: true });
    const count = {};
    for (const s of list) for (const g of s.g) count[g] = (count[g] || 0) + 1;
    $("dn-genres").innerHTML = D.genres.filter((g) => !REGION_G.has(g.id) && (count[g.id] || S.genres.has(g.id))).map((g) =>
      `<button class="chip dn-g" type="button" aria-pressed="${S.genres.has(g.id)}" data-g="${g.id}"><span aria-hidden="true">${g.icon}</span>${esc(g.label)} <span class="muted">${count[g.id] || 0}</span></button>`).join("")
      + (S.genres.size ? `<button class="chip dn-clear" type="button" data-g="">Show every genre</button>` : "");
  }

  function drawSegs() {
    $("dn-region").innerHTML = REGIONS.map(([k, l, sh]) => `<button role="tab" aria-selected="${k === S.region}" data-r="${k}">${sh ? `<span class="dn-long">${l}</span><span class="dn-short">${sh}</span>` : l}</button>`).join("");
    $("dn-time").innerHTML = TIMES.map(([h, l]) => `<button role="tab" aria-selected="${h === S.hours}" data-h="${h}" title="Stories from the past ${h} hours">${l}</button>`).join("");
    $("dn-tab").innerHTML = [["all", "All stories"], ["saved", `★ Saved${saved.length ? " " + saved.length : ""}`]].map(([k, l]) => `<button role="tab" aria-selected="${k === S.tab}" data-tab="${k}">${l}</button>`).join("");
    $("dn-view").innerHTML = [["cards", "Cards"], ["list", "Headlines"]].map(([k, l]) => `<button role="tab" aria-selected="${k === S.view}" data-v="${k}">${l}</button>`).join("");
    $("dn-sort").value = S.sort;
    $("dn-hide-read").checked = S.hideRead;
  }

  function drawSources() {
    const box = $("dn-sources");
    if (box.hidden) return;
    const list = D.outlets.filter((o) => o.n).sort((a, b) => a.name.localeCompare(b.name));
    box.innerHTML = `<div class="dn-src-tools"><button class="chip" type="button" data-all="1">Turn all on</button><button class="chip" type="button" data-all="0">Turn all off</button><span class="muted dn-small">Tap an outlet to hide or show it.</span></div>
      <div class="dn-src-grid">${list.map((o) => `<label class="dn-src"><input type="checkbox" data-o="${o.id}" ${S.off.has(o.id) ? "" : "checked"}><span class="dn-badge" style="--h:${hue(o.id)}">${esc(initials(o.name))}</span><span>${esc(o.name)} <span class="muted">${o.n}</span></span></label>`).join("")}</div>`;
  }

  // Words showing up in many of the current headlines
  const STOP = new Set(("a an the and or but of to in on at for with from by as is are was were be been has have had it its this that these those after before over under into about amid says said say new more most first last top how why what who when where will would could should can may not no than then them they their his her he she you your our we up down out off just now year years week day days time against during while still also live updates update latest report reports video watch photos two three one get gets got make makes made take takes back many some here there all any every other another big next could being his him its it’s it's says vs best near amid what’s what's don’t can’t won’t").split(" "));
  // Parts of state and province names (South, Carolina…) say where, not what
  for (const n of Object.values(PLACE)) for (const w of n.toLowerCase().split(/\s+/)) STOP.add(w);
  for (const w of "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december state game games season today tonight week's".split(" ")) STOP.add(w);
  function drawTrend(list) {
    const n = {};
    for (const s of list) for (const w of new Set((s.t.match(/[A-Za-z][A-Za-z'’.-]{2,}/g) || []).map((w) => w.replace(/['’]s$/, "").replace(/[.’'-]+$/, "")))) {
      const k = w.toLowerCase();
      if (STOP.has(k) || k.length < 4) continue;
      n[k] = n[k] || { w: /^[A-Z]/.test(w) ? w : k, c: 0 };
      n[k].c++;
    }
    const top = Object.values(n).filter((x) => x.c >= 3).sort((a, b) => b.c - a.c).slice(0, 16);
    $("dn-trend").innerHTML = top.length ? `<span class="muted dn-small">Trending words</span>` + top.map((x) =>
      `<button class="chip dn-word" type="button" data-word="${esc(x.w)}" aria-pressed="${S.q === x.w.toLowerCase()}">${esc(x.w)} <span class="muted">${x.c}</span></button>`).join("") : "";
  }

  function hue(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function initials(name) { return name.replace(/^The /, "").split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }
  const gIcons = (s) => s.g.filter((g) => GEN[g] && !REGION_G.has(g)).slice(0, 3).map((g) => `<span title="${esc(GEN[g].label)}">${GEN[g].icon}</span>`).join("");
  const placeTags = (s) => s.geo.slice(0, 2).map((p) => `<button class="tag dn-place-tag" type="button" data-goto="${p}">${p.startsWith("CA-") ? "🇨🇦" : "🇺🇸"} ${esc(PLACE[p] || p)}</button>`).join("");

  function card(s) {
    const isNew = s.ts > lastVisit && lastVisit > 0;
    // Stories without a picture (or whose picture fails to load) become text cards
    const img = s.img ? `<img src="${esc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()">` : "";
    return `<article class="panel dn-story${read.has(s.u) ? " read" : ""}" data-i="${s.i}" style="--h:${hue(s.o)}">
      ${S.view === "cards" && img ? `<a class="dn-media" href="${esc(s.u)}" target="_blank" rel="noopener" data-open="${s.i}" tabindex="-1" aria-hidden="true">${img}</a>` : ""}
      <div class="dn-body">
        <div class="story-meta"><span class="dn-src-name"><span class="dn-dot"></span>${esc(s.s)}</span><span>${esc(ago(s.ts))}</span>${isNew && !read.has(s.u) ? `<span class="dn-new">NEW</span>` : ""}<span class="dn-gi">${gIcons(s)}</span></div>
        <h3><a href="${esc(s.u)}" target="_blank" rel="noopener" data-open="${s.i}">${esc(s.t)}</a></h3>
        ${S.view === "cards" && s.sum ? `<p>${esc(s.sum)}</p>` : ""}
        <div class="dn-foot">${placeTags(s)}<span class="dn-spacer"></span>
          <button class="dn-act" type="button" data-share="${s.i}" title="Share or copy link" aria-label="Share">↗</button>
          <button class="dn-act dn-save" type="button" data-save="${s.i}" aria-pressed="${isSaved(s.u)}" title="${isSaved(s.u) ? "Saved" : "Save for later"}" aria-label="Save for later">${isSaved(s.u) ? "★" : "☆"}</button></div>
      </div></article>`;
  }

  let shown = [];
  function draw() {
    drawSegs(); drawMap(); drawGenres(); drawSources();
    let list = current();
    list = S.tab === "saved" ? list : S.sort === "mix" ? mix(list.slice().sort((a, b) => b.ts - a.ts)) : list.slice().sort((a, b) => b.ts - a.ts);
    shown = list;
    drawTrend(S.tab === "saved" ? [] : current({ ignoreGenre: false }));
    const where = S.place ? PLACE[S.place] : S.region === "all" ? "" : REGIONS.find((r) => r[0] === S.region)[1].replace(/^\S+ /, "");
    const gl = [...S.genres].map((g) => GEN[g] && GEN[g].label).filter(Boolean);
    $("dn-count").textContent = S.tab === "saved" ? `${list.length} saved ${list.length === 1 ? "story" : "stories"}.`
      : `${list.length.toLocaleString()} ${list.length === 1 ? "story" : "stories"}${where ? " · " + where : ""}${gl.length ? " · " + gl.join(", ") : ""}${S.q ? ` · matching “${S.q}”` : ""} · past ${S.hours} hours.`;
    feedEl.className = "dn-feed " + (S.view === "list" ? "list" : "cards");
    feedEl.innerHTML = list.length ? list.slice(0, S.n).map(card).join("")
      : `<div class="panel empty">${S.tab === "saved" ? "Nothing saved yet. Tap ☆ on any story to keep it here." : "No stories match. Try a longer time window, another genre or clear the search."}</div>`;
    $("dn-more").innerHTML = list.length > S.n ? `<button class="btn" type="button" id="dn-more-btn">Show ${Math.min(30, list.length - S.n)} more · ${list.length - S.n} left</button>` : "";
  }
  const findStory = (i) => S.tab === "saved" ? saved.map((s, k) => ({ ...s, i: "s" + k }))[+String(i).slice(1)] : S0[+i];

  // ---- events
  const reset = () => { S.n = 30; save(); draw(); };
  $("dn-region").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; S.region = b.dataset.r; S.place = ""; reset(); });
  $("dn-time").addEventListener("click", (e) => { const b = e.target.closest("[data-h]"); if (!b) return; S.hours = +b.dataset.h; reset(); });
  $("dn-tab").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; S.tab = b.dataset.tab; reset(); });
  $("dn-view").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; S.view = b.dataset.v; save(); draw(); });
  $("dn-sort").addEventListener("change", (e) => { S.sort = e.target.value; reset(); });
  $("dn-hide-read").addEventListener("change", (e) => { S.hideRead = e.target.checked; reset(); });
  $("dn-genres").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    const g = b.dataset.g;
    if (!g) S.genres.clear(); else if (S.genres.has(g)) S.genres.delete(g); else S.genres.add(g);
    reset();
  });
  $("dn-map").addEventListener("click", (e) => { const b = e.target.closest("[data-place]"); if (!b) return; S.place = S.place === b.dataset.place ? "" : b.dataset.place; reset(); });
  $("dn-map").addEventListener("change", (e) => { if (e.target.id === "dn-place") { S.place = e.target.value; reset(); } });
  $("dn-src-btn").addEventListener("click", (e) => { const box = $("dn-sources"); box.hidden = !box.hidden; e.currentTarget.setAttribute("aria-expanded", String(!box.hidden)); drawSources(); });
  $("dn-sources").addEventListener("change", (e) => { const c = e.target.closest("[data-o]"); if (!c) return; if (c.checked) S.off.delete(c.dataset.o); else S.off.add(c.dataset.o); reset(); });
  $("dn-sources").addEventListener("click", (e) => {
    const b = e.target.closest("[data-all]"); if (!b) return;
    S.off = b.dataset.all === "1" ? new Set() : new Set(D.outlets.map((o) => o.id)); reset();
  });
  $("dn-trend").addEventListener("click", (e) => {
    const b = e.target.closest("[data-word]"); if (!b) return;
    const w = b.dataset.word.toLowerCase();
    S.q = S.q === w ? "" : w; $("dn-q").value = S.q; reset();
  });
  let qt;
  $("dn-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); S.n = 30; draw(); }, 150); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $("dn-q").focus(); }
  });
  $("dn-more").addEventListener("click", (e) => { if (e.target.closest("#dn-more-btn")) { S.n += 30; draw(); } });

  document.addEventListener("click", async (e) => {
    const open = e.target.closest("[data-open]");
    if (open) {
      const s = findStory(open.dataset.open);
      if (s) { markRead(s.u); const art = open.closest(".dn-story"); if (art) art.classList.add("read"); }
      return;
    }
    const sv = e.target.closest("[data-save]");
    if (sv) {
      const s = findStory(sv.dataset.save); if (!s) return;
      const on = toggleSave(s);
      if (S.tab === "saved") { draw(); return; }
      sv.setAttribute("aria-pressed", String(on)); sv.textContent = on ? "★" : "☆";
      drawSegs();
      return;
    }
    const sh = e.target.closest("[data-share]");
    if (sh) {
      const s = findStory(sh.dataset.share); if (!s) return;
      try {
        if (navigator.share) await navigator.share({ title: s.t, url: s.u });
        else { await navigator.clipboard.writeText(s.u); toast("Link copied"); }
      } catch {}
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) {
      S.tab = "all"; S.region = go.dataset.goto.startsWith("CA-") ? "canada" : "us"; S.place = go.dataset.goto; reset();
      $("dn-map").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  // ---- big stories: tap one to see each outlet's headline side by side
  const big = (D.big || []).map((g) => g.map((i) => S0[i]).filter(Boolean)).filter((g) => g.length >= 3);
  $("dn-big").innerHTML = big.length ? big.map((g, k) => {
    const lead = g.find((s) => s.img) || g[0];
    const outlets = [...new Map(g.map((s) => [s.o, s])).values()];
    return `<button type="button" class="panel dn-big-card" data-big="${k}" style="--h:${hue(lead.o)}">
      ${lead.img ? `<img src="${esc(lead.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <span class="dn-big-n">${outlets.length} outlets</span>
      <span class="dn-big-t">${esc(g[0].t)}</span>
      <span class="dn-badges">${outlets.slice(0, 6).map((s) => `<span class="dn-badge" style="--h:${hue(s.o)}" title="${esc(s.s)}">${esc(initials(s.s))}</span>`).join("")}${outlets.length > 6 ? `<span class="dn-badge more">+${outlets.length - 6}</span>` : ""}</span>
    </button>`;
  }).join("") : `<div class="panel empty">No story is being covered by three or more outlets right now.</div>`;
  const dlg = $("dn-dialog"), dlgBody = $("dn-dialog-body");
  const openDialog = (html) => { dlgBody.innerHTML = html; if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); };
  const closeBtn = `<button class="dn-x" type="button" data-close aria-label="Close">✕</button>`;
  const line = (s) => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener" data-open="${s.i}"><span class="dn-badge" style="--h:${hue(s.o)}">${esc(initials(s.s))}</span><span><b>${esc(s.s)}</b> <span class="muted">${esc(ago(s.ts))}</span><br>${esc(s.t)}</span></a></li>`;
  $("dn-big").addEventListener("click", (e) => {
    const b = e.target.closest("[data-big]"); if (!b) return;
    const g = big[+b.dataset.big].slice().sort((a, b) => b.ts - a.ts);
    openDialog(`${closeBtn}<h2>How ${new Set(g.map((s) => s.o)).size} outlets are telling it</h2><p class="muted dn-small">Same story, different headlines. Tap any to read it.</p><ul class="dn-list">${g.map(line).join("")}</ul>`);
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
    const again = e.target.closest("[data-again]");
    if (again) surprise();
  });

  // ---- two-minute briefing: the freshest big story, then one story per genre
  $("dn-brief").addEventListener("click", () => {
    const fresh = S0.filter((s) => Date.now() - s.ts <= 24 * 36e5 && !S.off.has(s.o));
    const usedU = new Set(), picks = [];
    for (const g of big.slice(0, 3)) { picks.push(["🔥", "Big story", g[0]]); g.forEach((s) => usedU.add(s.u)); }
    const order = ["world", "us", "canada", "politics", "business", "markets", "tech", "science", "health", "weather", "sports", "sportsbiz", "betting", "entertainment", "crypto", "good"];
    for (const id of order) {
      const g = GEN[id]; if (!g) continue;
      // Prefer a story many outlets share words with, else the newest one with a picture
      const cands = fresh.filter((s) => s.g[0] === id || (s.g.includes(id) && !REGION_G.has(id))).filter((s) => !usedU.has(s.u));
      const s = cands.find((x) => x.img) || cands[0];
      if (s) { picks.push([g.icon, g.label, s]); usedU.add(s.u); }
    }
    openDialog(`${closeBtn}<h2>⚡ Your 2-minute briefing</h2><p class="muted dn-small">${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: the biggest stories, then one from each corner of the news.</p>
      <ol class="dn-brief">${picks.map(([icon, label, s]) => `<li><span class="dn-brief-g">${icon} ${esc(label)}</span><a href="${esc(s.u)}" target="_blank" rel="noopener" data-open="${s.i}">${esc(s.t)}</a><span class="muted dn-small"> · ${esc(s.s)}, ${esc(ago(s.ts))}</span></li>`).join("")}</ol>`);
  });

  // ---- surprise me: a random unread story from what's on screen
  function surprise() {
    const list = (shown.length ? shown : S0).filter((s) => !read.has(s.u) && s.t.length > 25);
    if (!list.length) { toast("You've read everything here!"); return; }
    const s = list[Math.floor(Math.random() * list.length)];
    openDialog(`${closeBtn}<p class="dn-small muted">🎲 Random pick from ${list.length.toLocaleString()} unread stories</p>
      ${s.img ? `<img class="dn-pick-img" src="${esc(s.img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <div class="story-meta"><span>${esc(s.s)}</span><span>${esc(ago(s.ts))}</span><span>${gIcons(s)}</span></div>
      <h2 class="dn-pick-t">${esc(s.t)}</h2>${s.sum ? `<p>${esc(s.sum)}</p>` : ""}
      <div class="dn-pick-btns"><a class="btn primary" href="${esc(s.u)}" target="_blank" rel="noopener" data-open="${s.i}">Read it →</a><button class="btn" type="button" data-again>🎲 Another</button><button class="btn" type="button" data-save="${s.i}" aria-pressed="${isSaved(s.u)}">${isSaved(s.u) ? "★" : "☆"}</button></div>`);
  }
  $("dn-surprise").addEventListener("click", surprise);

  // Footer: every outlet and how its stories were gathered
  $("dn-foot").innerHTML = `Outlets: ${D.outlets.filter((o) => o.n).map((o) => `<a href="https://${esc(o.site)}" target="_blank" rel="noopener">${esc(o.name.replace(" (via Google News)", ""))}</a>${o.how === "search" ? "*" : ""}`).join(", ")}. <br>* Headlines found through Google News because the outlet has no public feed. Not financial advice.`;

  draw();
})();
