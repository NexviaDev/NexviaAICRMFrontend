/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

async function loadConfig() {
  try {
    const res = await fetch('/api/push-notifications/web-config', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    const c = data?.config || {};
    if (!c.apiKey || !c.projectId || !c.messagingSenderId || !c.appId || !c.vapidKey) return null;
    return c;
  } catch (_) {
    return null;
  }
}

loadConfig().then((config) => {
  if (!config) return;
  firebase.initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain || undefined,
    projectId: config.projectId,
    storageBucket: config.storageBucket || undefined,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || 'Nexvia CRM';
    const body = payload?.notification?.body || '새 알림이 도착했습니다.';
    self.registration.showNotification(title, {
      body,
      icon: '/nexvia-app-icon.png',
      data: payload?.data || {}
    });
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
      return null;
    })
  );
});
