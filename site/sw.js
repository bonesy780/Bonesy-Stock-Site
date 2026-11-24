// Service worker for push price alerts. The live service (worker/extras.js) sends an empty push when one of
// this browser's alerts goes off; this asks the service which ones fired and shows them as notifications.
const API = new URL(self.location.href).searchParams.get("api") || "";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch(`${API}/push/inbox?read=1&ep=${encodeURIComponent(sub.endpoint)}`);
      const d = await res.json();
      items = (d.fired || []).slice(0, Math.max(1, Math.min(3, d.unread || 1)));
    } catch (err) { /* fall back to a general notice */ }
    if (!items.length) {
      return self.registration.showNotification("Price alert", { body: "One of your price alerts went off. Open the Alerts page to see it.", tag: "price-alert", icon: "icon-192.png", data: { url: "alerts.html" } });
    }
    for (const a of items) {
      await self.registration.showNotification("🔔 Price alert", {
        body: a.text + (a.note ? " " + a.note : ""), tag: a.id || a.t, icon: "icon-192.png", badge: "icon-192.png",
        data: { url: "stock.html?t=" + encodeURIComponent(a.t) },
      });
    }
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "alerts.html", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url === url && "focus" in w) return w.focus();
    return self.clients.openWindow(url);
  })());
});
