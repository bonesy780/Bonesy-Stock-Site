// Which news outlets make readers sign in or pay before they can read a story, so the news pages can say so
// on the story before it's opened. Matched on the story's web address, the outlet's own site, or its name
// (Google News links hide the publisher's address, so the name is the fallback). Outlets change their
// rules now and then; update the lists here when they do.
(function () {
  // Paid subscription needed for nearly every story (you'll be asked to sign in or subscribe)
  const SUB = {
    sites: ["wsj.com", "ft.com", "bloomberg.com", "economist.com", "barrons.com", "nytimes.com/athletic", "theathletic.com",
      "theinformation.com", "businessinsider.com", "investors.com", "asia.nikkei.com", "theglobeandmail.com",
      "washingtonpost.com", "thetimes.co.uk", "thetimes.com", "telegraph.co.uk", "seekingalpha.com"],
    names: ["wall street journal", "the wall street journal", "wsj", "financial times", "ft", "bloomberg", "bloomberg.com",
      "the economist", "economist", "barron's", "barrons", "the athletic", "the information", "business insider",
      "investor's business daily", "nikkei asia", "the globe and mail", "globe and mail", "washington post",
      "the washington post", "the times", "the telegraph", "seeking alpha"],
  };
  // A few free stories, then a free account or a subscription
  const METER = {
    sites: ["nytimes.com", "latimes.com", "theatlantic.com", "wired.com", "newyorker.com", "scmp.com", "japantimes.co.jp",
      "thestar.com", "nationalpost.com", "marketwatch.com", "reuters.com", "fortune.com", "bostonglobe.com",
      "chicagotribune.com", "medium.com"],
    names: ["new york times", "the new york times", "nyt", "los angeles times", "la times", "the atlantic", "wired",
      "the new yorker", "south china morning post", "japan times", "the japan times", "toronto star", "national post",
      "marketwatch", "reuters", "fortune", "the boston globe", "chicago tribune"],
  };
  const LABEL = {
    sub: { icon: "🔒", text: "Subscription", tip: "Needs a paid subscription: you'll be asked to sign in or subscribe to read it" },
    meter: { icon: "🔑", text: "Sign-in", tip: "A few free stories, then the outlet asks you to sign in or subscribe" },
  };

  const hostPath = (u) => {
    try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).toLowerCase(); } catch { return ""; }
  };
  // "nytimes.com/athletic" matches that section; "wsj.com" matches wsj.com and any subdomain
  const siteIn = (hp, sites) => hp && sites.some((s) => {
    const [host, ...rest] = s.split("/");
    const path = rest.length ? "/" + rest.join("/") : "";
    const [h, ...p] = hp.split("/");
    const okHost = h === host || h.endsWith("." + host);
    return okHost && (!path || ("/" + p.join("/")).startsWith(path));
  });
  const clean = (n) => String(n || "").toLowerCase().replace(/\s*\(.*\)\s*$/, "").replace(/\s+/g, " ").trim();

  // story: { url, site, source } (any may be missing). Returns "sub", "meter" or null.
  function access({ url, site, source } = {}) {
    for (const where of [hostPath(url), site ? hostPath("https://" + site) : ""]) {
      if (!where || where.startsWith("news.google.com")) continue;
      // The Athletic sits under nytimes.com, so check the stricter list first
      if (siteIn(where, SUB.sites)) return "sub";
      if (siteIn(where, METER.sites)) return "meter";
    }
    const n = clean(source);
    if (SUB.names.includes(n)) return "sub";
    if (METER.names.includes(n)) return "meter";
    return null;
  }

  // A small tag for a story card, or "" when the story is free to read
  function tag(kind, cls = "tag") {
    const l = LABEL[kind];
    if (!l) return "";
    return `<span class="${cls} access-${kind}" title="${l.tip}"><span aria-hidden="true">${l.icon}</span> ${l.text}</span>`;
  }

  window.Paywall = { access, tag, LABEL };
})();
