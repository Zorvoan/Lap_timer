/*
 * Loaded into the service worker (workbox importScripts). Shows the notifications sent by
 * scripts/notify-overtakes.ts through Firebase Cloud Messaging, and opens the app on tap.
 * Messages carry their text in `data` ({ title, body, url, tag }) so this file decides how they look.
 */
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = {};
  }
  const d = msg.data || {};
  const n = msg.notification || {};
  const title = d.title || n.title || 'Lap Timer';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || n.body || '',
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
