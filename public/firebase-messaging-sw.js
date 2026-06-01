/**
 * 로컬 개발용 FCM SW (Vite dev — Workbox 미사용).
 * 프로덕션 빌드는 src/firebase-messaging-sw.js 가 /firebase-messaging-sw.js 로 번들됩니다.
 */
/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

const NEXVIA_PUSH_API_BASE = '/api';
let firebaseBackgroundHandlerReady = false;

const PUSH_META_DB = 'nexvia_push';
const PUSH_META_STORE = 'meta';
const PUSH_META_SESSION_KEY = 'session';
let pushSessionMeta = { userId: '', companyId: '' };
let pushSessionMetaLoaded = false;

function openPushMetaDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUSH_META_DB, 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(PUSH_META_STORE)) {
        db.createObjectStore(PUSH_META_STORE);
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function ensurePushSessionMetaLoaded() {
  if (pushSessionMetaLoaded) return pushSessionMeta;
  try {
    const db = await openPushMetaDb();
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(PUSH_META_STORE, 'readonly');
      const req = tx.objectStore(PUSH_META_STORE).get(PUSH_META_SESSION_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (row) {
      pushSessionMeta = {
        userId: String(row.userId || ''),
        companyId: String(row.companyId || '')
      };
    }
  } catch (_) {
    /* ignore */
  }
  pushSessionMetaLoaded = true;
  return pushSessionMeta;
}

function shouldDeliverPushData(data) {
  const uid = String(pushSessionMeta.userId || '').trim();
  if (!uid) return false;
  const recipientUserId = String(data.recipientUserId || '').trim();
  if (recipientUserId && recipientUserId !== uid) return false;
  const companyId = String(data.companyId || '').trim();
  if (companyId && pushSessionMeta.companyId && companyId !== pushSessionMeta.companyId) return false;
  return true;
}

function buildDisplayFromPayload(payload) {
  const notification = payload?.notification || {};
  const data = {
    ...(payload?.data && typeof payload.data === 'object' ? payload.data : {}),
    ...(notification.data && typeof notification.data === 'object' ? notification.data : {})
  };
  const title = String(notification.title || data.title || 'Nexvia CRM').trim();
  let body = String(notification.body || data.body || '').trim();
  if (!body) {
    if (data.type === 'announcement') body = '새 공지사항이 등록되었습니다.';
    else if (data.type === 'calendar-reminder') body = '일정 알림이 도착했습니다.';
    else if (data.type === 'lead-capture') body = '새 리드가 수신되었습니다.';
    else if (data.type === 'project-comment') body = '프로젝트 코멘트에서 언급되었습니다.';
    else if (data.type === 'admin-user-signup') body = '회원가입·회원 정보 변경 알림이 도착했습니다.';
    else body = '탭하여 내용을 확인하세요.';
  }
  const tag =
    notification.tag ||
    data.tag ||
    (data.notificationId ? `announcement-${data.notificationId}` : undefined) ||
    (data.eventId ? `calendar-reminder-${data.eventId}` : undefined);
  return { title, body, data, tag };
}

function showCrmNotification(payload) {
  const { title, body, data, tag } = buildDisplayFromPayload(payload);
  return self.registration.showNotification(title, {
    body,
    icon: '/nexvia-app-icon.png',
    badge: '/nexvia-app-icon.png',
    tag,
    renotify: true,
    data
  });
}

async function showCrmNotificationIfAllowed(payload) {
  await ensurePushSessionMetaLoaded();
  const { data } = buildDisplayFromPayload(payload);
  if (!shouldDeliverPushData(data)) return null;
  return showCrmNotification(payload);
}

function initFirebaseWithConfig(cfg) {
  if (!cfg?.apiKey || !cfg?.projectId || !cfg?.messagingSenderId || !cfg?.appId) return false;
  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain || undefined,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket || undefined,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId
    });
  }
  firebase.messaging().onBackgroundMessage((payload) => showCrmNotificationIfAllowed(payload));
  firebaseBackgroundHandlerReady = true;
  return true;
}

async function loadConfigAndInitFirebase() {
  try {
    const res = await fetch(`${NEXVIA_PUSH_API_BASE}/push-notifications/web-config`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    return initFirebaseWithConfig(json?.config || json);
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(loadConfigAndInitFirebase());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await loadConfigAndInitFirebase();
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'PUSH_SESSION_META') {
    pushSessionMeta = {
      userId: String(msg.userId || ''),
      companyId: String(msg.companyId || '')
    };
    pushSessionMetaLoaded = true;
    return;
  }
  if (!msg || msg.type !== 'INIT_FIREBASE' || !msg.config) return;
  event.waitUntil(Promise.resolve(initFirebaseWithConfig(msg.config)));
});

self.addEventListener('push', (event) => {
  if (firebaseBackgroundHandlerReady) return;
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }
  event.waitUntil(showCrmNotificationIfAllowed(payload));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let targetUrl = data.url || '/notification';
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
