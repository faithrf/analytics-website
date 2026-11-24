/* Meridian push worker. Push and click only: no caching and no fetch handler,
   so it can't interfere with deploys or components/AutoUpdate.tsx. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Meridian", {
      body: d.body || "",
      icon: "/pwa-icon?size=192",
      badge: "/pwa-icon?size=192",
      tag: d.tag || "meridian",
      renotify: true,
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "navigate" in c) {
          return c.navigate(url).then((w) => (w || c).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
