// Ask page: questions about how the site gets its data.
// Answers come from Claude (through the live service's /ask route) when that is
// switched on, otherwise from the site's own notes in ask-kb.json, matched by keyword.
(async function () {
  const { esc, store } = window.UI;
  const $ = (id) => document.getElementById(id);
  const PAGE_NAMES = {
    "markets.html": "Markets", "stock.html": "Stock Lookup", "watchlist.html": "Watchlists", "portfolio.html": "Paper Trading",
    "screener.html": "Screener", "movers.html": "Movers", "brief.html": "Daily Brief", "heatmap.html": "Heatmap",
    "signals.html": "Signals", "analysts.html": "Analysts", "dividends.html": "Dividends", "earnings.html": "Earnings",
    "calendar.html": "Calendar", "compare.html": "Compare", "backtest.html": "Backtest", "options.html": "Options",
    "alerts.html": "Alerts", "tools.html": "Calculators", "./": "News",
  };
  const STARTERS = ["overview", "52week", "analyst", "schedule", "news", "ranking"];
  const HKEY = "askChat";

  $("updated").textContent = "";
  let KB = [];
  try {
    KB = await (await fetch("ask-kb.json", { cache: "no-store" })).json();
  } catch {
    $("log").innerHTML = `<div class="empty">The notes could not be loaded. Try reloading the page.</div>`;
    return;
  }
  const byId = Object.fromEntries(KB.map((k) => [k.id, k]));

  // ---- matching a question to the notes
  const STOP = new Set("a an the is are was were do does did how what where when why who which of to in on for from by with and or it its this that these those you your i me my site website get gets got come comes data number numbers".split(" "));
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9/\- ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  function match(q) {
    const text = " " + String(q).toLowerCase() + " ";
    const ws = new Set(words(q));
    return KB.map((k) => {
      let score = 0;
      for (const key of k.keys) {
        if (key.includes(" ")) { if (text.includes(key)) score += 4; }
        else if (ws.has(key) || ws.has(key + "s") || (key.length > 4 && [...ws].some((w) => w.startsWith(key)))) score += STOP.has(key) ? 0 : 3;
      }
      for (const w of words(k.title)) if (ws.has(w)) score += 1;
      return { k, score };
    }).filter((x) => x.score >= 3).sort((a, b) => b.score - a.score);
  }

  // ---- Claude, if the live service has it switched on
  let ai = false;
  const api = window.Live && window.Live.api;
  if (api) {
    try { ai = !!(await (await fetch(`${api}/ask`)).json()).ai; } catch { ai = false; }
  }
  $("mode").textContent = ai
    ? "Answers come from Claude, using the site's notes on where its data comes from. It can make mistakes."
    : "Answers come from the site's built-in notes on where its data comes from.";

  // ---- conversation
  let chat = (() => { try { return JSON.parse(sessionStorage.getItem(HKEY)) || []; } catch { return []; } })();
  const save = () => { try { sessionStorage.setItem(HKEY, JSON.stringify(chat.slice(-30))); } catch {} };
  const para = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  const pageLink = (k) => k.page ? `<a class="ask-page" href="${esc(k.page)}">Open ${esc(PAGE_NAMES[k.page] || k.page)} →</a>` : "";
  const related = (ids) => ids && ids.length
    ? `<div class="ask-related"><span class="hint">Related:</span> ${ids.map((id) => byId[id] ? `<button class="chip" type="button" data-topic="${id}">${esc(byId[id].title)}</button>` : "").join("")}</div>` : "";

  function render() {
    const log = $("log");
    if (!chat.length) {
      log.innerHTML = `<div class="ask-intro"><p>Try one of these, or type your own question below.</p>
        <div class="chips">${STARTERS.filter((id) => byId[id]).map((id) => `<button class="chip" type="button" data-q="${esc(byId[id].title)}">${esc(byId[id].title)}</button>`).join("")}</div></div>`;
    } else {
      log.innerHTML = chat.map((m) => m.role === "user"
        ? `<div class="ask-msg me"><div class="bubble">${esc(m.text)}</div></div>`
        : `<div class="ask-msg bot"><div class="bubble${m.wait ? " wait" : ""}">${m.wait ? "Thinking…" : para(m.text)}${m.topic && byId[m.topic] ? pageLink(byId[m.topic]) : ""}${m.note ? `<div class="hint">${esc(m.note)}</div>` : ""}${related(m.related)}</div></div>`).join("");
    }
    $("clear").hidden = !chat.length;
    log.scrollTop = log.scrollHeight;
  }

  function fromNotes(q) {
    const hits = match(q);
    if (!hits.length && /\b(where|source|come|comes|data|get|gets|from)\b/i.test(q)) hits.push({ k: byId.overview, score: 1 });
    if (!hits.length) {
      return { text: "I don't have a note on that yet. Here are the topics I can explain; pick the closest one, or ask in other words.", related: STARTERS };
    }
    const top = hits[0].k;
    return { text: top.answer, topic: top.id, related: hits.slice(1, 4).map((h) => h.k.id) };
  }

  let busy = false;
  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    busy = true;
    $("send").disabled = true;
    const history = chat.filter((m) => !m.wait).map((m) => ({ role: m.role, text: m.text }));
    chat.push({ role: "user", text: q });
    if (!ai) {
      chat.push({ role: "assistant", ...fromNotes(q) });
    } else {
      const wait = { role: "assistant", wait: true, text: "" };
      chat.push(wait);
      render();
      const local = fromNotes(q);
      try {
        const res = await fetch(`${api}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.answer) throw new Error(out.error || "no answer");
        // Claude's own answer, with the closest notes offered underneath
        Object.assign(wait, { wait: false, text: out.answer, related: local.topic ? [local.topic, ...local.related].slice(0, 3) : [] });
      } catch (e) {
        Object.assign(wait, { wait: false, ...local, note: `Claude couldn't answer (${e.message}), so this is from the site's notes.` });
      }
    }
    save();
    render();
    busy = false;
    $("send").disabled = false;
    $("q").focus();
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("q").value;
    $("q").value = "";
    ask(q);
  });
  $("log").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.q) ask(b.dataset.q);
    if (b.dataset.topic && byId[b.dataset.topic]) {
      const k = byId[b.dataset.topic];
      chat.push({ role: "user", text: k.title }, { role: "assistant", text: k.answer, topic: k.id });
      save();
      render();
    }
  });
  $("clear").addEventListener("click", () => { chat = []; save(); render(); $("q").focus(); });

  // ---- every topic, open to read
  const open = store.get("askOpen", null);
  $("topics").innerHTML = KB.map((k) => `<details class="ask-topic" data-id="${k.id}"${open === k.id ? " open" : ""}>
    <summary>${esc(k.title)}</summary><div class="ask-body">${para(k.answer)}${pageLink(k)}</div></details>`).join("");
  $("topics").addEventListener("toggle", (e) => { if (e.target.open) store.set("askOpen", e.target.dataset.id); }, true);

  render();
})();
