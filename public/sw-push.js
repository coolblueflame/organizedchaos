/**
 * Web Push handlers, imported into the generated service worker (see
 * vite.config.ts workbox.importScripts). The payload is JSON authored by the
 * reminders workflow in the DATA repo: { title, body, url? }.
 */
self.addEventListener('push', (event) => {
  let data = { title: 'organized chaos', body: 'something needs you' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* a malformed payload still shows the fallback note */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || 'oc-reminder',
      data: { url: data.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
