import { API_BASE } from '@/config';

let foregroundUnsubscribe = null;
let firebaseSdkPromise = null;

const FIREBASE_SDK_VERSION = '12.13.0';
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`;
const FIREBASE_MESSAGING_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-messaging.js`;
const PUSH_STEP_TIMEOUT_MS = 10000;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function canUsePushNotifications() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function normalizeFirebaseConfig(raw) {
  const cfg = raw?.config || raw || {};
  const config = {
    apiKey: String(cfg.apiKey || '').trim(),
    authDomain: String(cfg.authDomain || '').trim(),
    projectId: String(cfg.projectId || '').trim(),
    storageBucket: String(cfg.storageBucket || '').trim(),
    messagingSenderId: String(cfg.messagingSenderId || '').trim(),
    appId: String(cfg.appId || '').trim()
  };
  const vapidKey = String(cfg.vapidKey || '').trim();
  return { config, vapidKey };
}

async function fetchFirebaseWebConfig() {
  const res = await fetch(`${API_BASE}/push-notifications/web-config`, { headers: getAuthHeader() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Firebase 웹 설정을 불러오지 못했습니다.');
  const { config, vapidKey } = normalizeFirebaseConfig(data);
  if (!config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId || !vapidKey) {
    throw new Error('Firebase 웹 푸시 설정이 부족합니다.');
  }
  return { config, vapidKey };
}

async function registerTokenWithBackend(token) {
  const res = await fetch(`${API_BASE}/push-notifications/register-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ token, platform: 'web' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '푸시 토큰 등록에 실패했습니다.');
  return data;
}

async function loadFirebaseMessagingSdk() {
  if (!firebaseSdkPromise) {
    firebaseSdkPromise = Promise.all([
      import(/* @vite-ignore */ FIREBASE_APP_URL),
      import(/* @vite-ignore */ FIREBASE_MESSAGING_URL)
    ]).then(([appMod, messagingMod]) => ({ ...appMod, ...messagingMod }));
  }
  return firebaseSdkPromise;
}

function withTimeout(promise, message, timeoutMs = PUSH_STEP_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

async function ensurePushServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;

  // Vite dev server에서는 VitePWA가 기본적으로 SW를 만들지 않으므로 푸시 수신 전용 SW를 임시 등록합니다.
  if (import.meta.env.DEV) {
    return navigator.serviceWorker.register('/firebase-messaging-push.js', { scope: '/' });
  }

  return navigator.serviceWorker.ready;
}

function getOrCreateFirebaseApp(sdk, config) {
  const { initializeApp, getApp, getApps } = sdk;
  return getApps().length ? getApp() : initializeApp(config);
}

export async function getCalendarPushStatus() {
  if (!canUsePushNotifications()) {
    return { supported: false, permission: 'unsupported', registered: false };
  }
  const { isSupported } = await loadFirebaseMessagingSdk();
  return {
    supported: await isSupported().catch(() => false),
    permission: Notification.permission,
    registered: false
  };
}

export async function enableCalendarPushNotifications() {
  if (!canUsePushNotifications()) {
    return { ok: false, error: '이 브라우저는 푸시 알림을 지원하지 않습니다.' };
  }
  const { getMessaging, getToken, isSupported } = await withTimeout(
    loadFirebaseMessagingSdk(),
    'Firebase SDK를 불러오지 못했습니다. 인터넷 연결 또는 광고 차단 설정을 확인해 주세요.'
  );
  const supported = await isSupported().catch(() => false);
  if (!supported) return { ok: false, error: 'Firebase Messaging을 지원하지 않는 환경입니다.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, permission, error: '알림 권한이 허용되지 않았습니다.' };
  }

  const { config, vapidKey } = await withTimeout(
    fetchFirebaseWebConfig(),
    'Firebase 웹 푸시 설정 확인 시간이 초과되었습니다. 백엔드 재시작 여부를 확인해 주세요.'
  );
  const sdk = await withTimeout(
    loadFirebaseMessagingSdk(),
    'Firebase SDK를 불러오지 못했습니다.'
  );
  const app = getOrCreateFirebaseApp(sdk, config);
  const messaging = getMessaging(app);
  const registration = await withTimeout(
    ensurePushServiceWorkerRegistration(),
    'PWA 서비스 워커가 아직 준비되지 않았습니다. 프론트 화면을 새로고침한 뒤 다시 시도해 주세요.'
  );
  const token = await withTimeout(
    getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }),
    'FCM 토큰 발급 시간이 초과되었습니다. Firebase 설정과 브라우저 알림 권한을 확인해 주세요.'
  );
  if (!token) return { ok: false, permission, error: '푸시 토큰을 발급받지 못했습니다.' };

  await registerTokenWithBackend(token);
  return { ok: true, permission, token };
}

export async function bindCalendarForegroundNotifications(onReceive) {
  if (!canUsePushNotifications()) return null;
  const { getMessaging, isSupported, onMessage } = await loadFirebaseMessagingSdk();
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  try {
    const { config } = await fetchFirebaseWebConfig();
    const sdk = await loadFirebaseMessagingSdk();
    const app = getOrCreateFirebaseApp(sdk, config);
    const messaging = getMessaging(app);
    foregroundUnsubscribe?.();
    foregroundUnsubscribe = onMessage(messaging, (payload) => {
      if (typeof onReceive === 'function') onReceive(payload);
    });
    return foregroundUnsubscribe;
  } catch (_) {
    return null;
  }
}
