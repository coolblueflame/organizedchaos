/**
 * Web Push handlers, imported into the generated service worker (see
 * vite.config.ts workbox.importScripts). The payload is JSON authored by the
 * reminders workflow in the DATA repo: { title, body, url?, sentAt? }.
 */
self.addEventListener('push', (event) => {
  let data = { title: 'organized chaos', body: 'something needs you' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* a malformed payload still shows the fallback note */
  }

  /*
    Latency probes carry the instant they were sent, and THIS handler runs the
    moment the push lands — so the notification can state its own delivery
    time. Asking a human "how long did that take?" measures their memory, not
    the network: a rounded "about eight minutes ago" carries a minute of slop,
    which is the entire range that decides whether scheduled alarms are
    viable. Assumes the device clock is roughly true, which phones keep via
    NTP to well under a second.
  */
  let body = data.body;
  if (typeof data.sentAt === 'number') {
    const seconds = (Date.now() - data.sentAt) / 1000;
    const measured = seconds < 90
      ? `${seconds.toFixed(1)}s`
      : `${Math.round(seconds / 60)} min`;
    body = `${body}\n\n→ delivered in ${measured}`;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body,
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
