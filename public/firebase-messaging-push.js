/* Nexvia CRM calendar reminders: imported by the generated PWA service worker. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }

  const notification = payload.notification || payload.webpush?.notification || {};
  const data = {
    ...(payload.data || {}),
    ...(notification.data || {})
  };
  const title = notification.title || data.title || 'Nexvia CRM';
  const options = {
    body: notification.body || data.body || '',
    icon: notification.icon || '/nexvia-app-icon.png',
    badge: notification.badge || '/nexvia-app-icon.png',
    tag: notification.tag || (data.eventId ? `calendar-reminder-${data.eventId}` : undefined),
    data
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || (data.eventId ? `/calendar?modal=event&eventId=${encodeURIComponent(data.eventId)}` : '/calendar');
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(absoluteUrl);
        return null;
      }
    }
    return clients.openWindow(absoluteUrl);
  })());
});
