import { API_BASE } from '@/config';

let foregroundUnsubscribe = null;
let firebaseSdkPromise = null;

/** 로컬에 저장된 FCM 토큰 — 알림 해제·상태 표시용 */
export const CRM_PUSH_TOKEN_KEY = 'crm_fcm_push_token';
/** 브라우저·PWA 기기별 토큰 교체(폰 알림 재허용 시 갱신) */
export const CRM_PUSH_DEVICE_ID_KEY = 'crm_push_device_id';
/** 푸시 등록 시점 로그인 사용자 — 계정 전환·로그아웃 검증용 */
export const CRM_PUSH_OWNER_USER_ID_KEY = 'crm_push_owner_user_id';

const PUSH_META_DB = 'nexvia_push';
const PUSH_META_STORE = 'meta';
const PUSH_META_SESSION_KEY = 'session';

/** 사이드바 알람 아이콘 등 UI 동기화 */
export const CRM_PUSH_STATUS_EVENT = 'crm-push-status-changed';

function emitPushStatusChange(status) {
  try {
    window.dispatchEvent(new CustomEvent(CRM_PUSH_STATUS_EVENT, { detail: status }));
  } catch {
    /* ignore */
  }
}

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

export function getOrCreatePushDeviceId() {
  try {
    let id = String(localStorage.getItem(CRM_PUSH_DEVICE_ID_KEY) || '').trim();
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `d-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(CRM_PUSH_DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `d-${Date.now()}`;
  }
}

async function registerTokenWithBackend(token) {
  const deviceId = getOrCreatePushDeviceId();
  const res = await fetch(`${API_BASE}/push-notifications/register-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ token, platform: 'web', deviceId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '푸시 토큰 등록에 실패했습니다.');
  return data;
}

async function unregisterTokenWithBackend(token) {
  if (!token) return;
  const res = await fetch(`${API_BASE}/push-notifications/unregister-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ token })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '푸시 토큰 해제에 실패했습니다.');
  return data;
}

export function getStoredPushToken() {
  try {
    return String(localStorage.getItem(CRM_PUSH_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

function getStoredPushOwnerUserId() {
  try {
    return String(localStorage.getItem(CRM_PUSH_OWNER_USER_ID_KEY) || '').trim();
  } catch {
    return '';
  }
}

function setStoredPushOwnerUserId(userId) {
  try {
    const id = String(userId || '').trim();
    if (id) localStorage.setItem(CRM_PUSH_OWNER_USER_ID_KEY, id);
    else localStorage.removeItem(CRM_PUSH_OWNER_USER_ID_KEY);
  } catch {
    /* ignore */
  }
}

function getCurrentCrmUserFromStorage() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getCurrentCrmUserId() {
  const user = getCurrentCrmUserFromStorage();
  return String(user?._id || user?.id || '').trim();
}

function getCurrentCrmCompanyId() {
  const user = getCurrentCrmUserFromStorage();
  return String(user?.companyId || '').trim();
}

function isCrmSessionLoggedIn() {
  try {
    return Boolean(String(localStorage.getItem('crm_token') || '').trim() && getCurrentCrmUserId());
  } catch {
    return false;
  }
}

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

async function writePushSessionMeta(userId, companyId) {
  const meta = {
    userId: String(userId || '').trim(),
    companyId: String(companyId || '').trim(),
    updatedAt: Date.now()
  };
  try {
    const db = await openPushMetaDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PUSH_META_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      if (meta.userId) tx.objectStore(PUSH_META_STORE).put(meta, PUSH_META_SESSION_KEY);
      else tx.objectStore(PUSH_META_STORE).delete(PUSH_META_SESSION_KEY);
    });
  } catch {
    /* ignore */
  }
  try {
    const reg = await navigator.serviceWorker?.ready;
    reg?.active?.postMessage({
      type: 'PUSH_SESSION_META',
      userId: meta.userId,
      companyId: meta.companyId
    });
  } catch {
    /* ignore */
  }
}

/** 포그라운드·SW와 동일 — 로그인·계정 일치 시에만 알림 표시 */
export function shouldShowPushForCurrentSession(data = {}) {
  if (!isCrmSessionLoggedIn()) return false;
  const currentUserId = getCurrentCrmUserId();
  const recipientUserId = String(data.recipientUserId || '').trim();
  if (recipientUserId && recipientUserId !== currentUserId) return false;
  const companyId = String(data.companyId || '').trim();
  const currentCompanyId = getCurrentCrmCompanyId();
  if (companyId && currentCompanyId && companyId !== currentCompanyId) return false;
  return true;
}

/** 로그인 사용자와 푸시 등록 동기화 — 계정 전환 시 이전 계정 토큰을 현재 계정으로 이전 */
export async function syncPushRegistrationForSession(user) {
  const sessionUserId = String(user?._id || user?.id || '').trim();
  const sessionCompanyId = String(user?.companyId || '').trim();
  const crmToken = localStorage.getItem('crm_token');

  if (!crmToken || !sessionUserId) {
    await clearLocalPushRegistration();
    return { ok: false, reason: 'not-logged-in' };
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    if (getStoredPushToken()) await clearLocalPushRegistration();
    return { ok: false, reason: 'no-permission' };
  }

  const storedOwner = getStoredPushOwnerUserId();
  const storedPush = getStoredPushToken();

  if (storedPush && storedOwner && storedOwner !== sessionUserId) {
    await enablePushNotifications({ forceRefresh: true });
    setStoredPushOwnerUserId(sessionUserId);
    await writePushSessionMeta(sessionUserId, sessionCompanyId);
    emitPushStatusChange(await getPushNotificationStatus());
    return { ok: true, switched: true };
  }

  if (storedPush && !storedOwner) {
    await registerTokenWithBackend(storedPush);
    setStoredPushOwnerUserId(sessionUserId);
    await writePushSessionMeta(sessionUserId, sessionCompanyId);
    emitPushStatusChange(await getPushNotificationStatus());
    return { ok: true, repaired: true };
  }

  if (storedPush) {
    await writePushSessionMeta(sessionUserId, sessionCompanyId);
    await refreshPushTokenIfGranted();
    return { ok: true };
  }

  await writePushSessionMeta(sessionUserId, sessionCompanyId);
  return { ok: true, registered: false };
}

/** 로그아웃 시 — crm_token 삭제 전에 호출. UI는 즉시 전환하고 푸시 정리는 백그라운드. */
export function clearPushSessionOnLogout() {
  const stored = getStoredPushToken();
  const authHeader = getAuthHeader();

  setStoredPushToken('');
  setStoredPushOwnerUserId('');
  void writePushSessionMeta('', '');

  emitPushStatusChange({
    supported: canUsePushNotifications(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
    registered: false
  });

  if (stored && authHeader.Authorization) {
    void unregisterTokenWithBackend(stored).catch(() => {});
  }

  void clearFirebasePushTokenInBackground();
}

/** 로그아웃·계정 전환용 — Firebase SDK·SW 초기화 없이 가능한 범위에서만 토큰 삭제 시도 */
async function clearFirebasePushTokenInBackground() {
  try {
    const ctx = await withTimeout(
      getFirebaseMessagingContext(),
      '로그아웃 푸시 정리 시간 초과',
      3500
    );
    if (ctx.supported && ctx.messaging && ctx.sdk?.deleteToken) {
      await ctx.sdk.deleteToken(ctx.messaging);
    }
  } catch {
    /* ignore — 로컬·서버 토큰은 이미 해제됨 */
  }
}

function setStoredPushToken(token) {
  try {
    const t = String(token || '').trim();
    if (t) localStorage.setItem(CRM_PUSH_TOKEN_KEY, t);
    else localStorage.removeItem(CRM_PUSH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
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

export const FCM_SW_URL = '/firebase-messaging-sw.js';

function isFcmServiceWorkerUrl(scriptUrl) {
  return String(scriptUrl || '').includes('firebase-messaging-sw');
}

/** 예전 Workbox sw.js 제거 후 FCM 전용 SW만 사용 */
async function migrateToFcmServiceWorker() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs.map(async (reg) => {
      const url = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
      if (url && !isFcmServiceWorkerUrl(url)) {
        await reg.unregister();
      }
    })
  );
}

/** 앱 시작 시 FCM SW 등록 (가이드: public/firebase-messaging-sw.js) */
export function registerFcmServiceWorkerEarly() {
  if (!('serviceWorker' in navigator)) return;
  void migrateToFcmServiceWorker()
    .then(() => navigator.serviceWorker.register(FCM_SW_URL, { scope: '/' }))
    .then((reg) => {
      if (import.meta.env.DEV) {
        console.info('[FCM] Service Worker 등록', reg.scope, reg.active?.scriptURL || FCM_SW_URL);
      }
    })
    .catch((err) => {
      if (import.meta.env.DEV) console.warn('[FCM] Service Worker 등록 실패', err);
    });
}

async function waitForServiceWorkerActive(registration) {
  if (registration.active) return registration.active;
  const worker = registration.installing || registration.waiting;
  if (!worker) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return registration.active;
  }
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('서비스 워커 활성화 시간 초과')), PUSH_STEP_TIMEOUT_MS);
    worker.addEventListener('statechange', () => {
      if (registration.active) {
        window.clearTimeout(timeout);
        resolve();
      }
    });
  });
  return registration.active;
}

/** FCM 백그라운드 수신용 — SW에 Firebase onBackgroundMessage 등록 */
async function initFirebaseInServiceWorker(registration, config) {
  const worker = await waitForServiceWorkerActive(registration);
  if (!worker) throw new Error('서비스 워커를 찾을 수 없습니다.');
  worker.postMessage({
    type: 'INIT_FIREBASE',
    config: {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId
    }
  });
  await new Promise((r) => setTimeout(r, 150));
}

async function ensurePushServiceWorkerRegistration() {
  await migrateToFcmServiceWorker();
  let registration = await navigator.serviceWorker.register(FCM_SW_URL, { scope: '/' });
  await navigator.serviceWorker.ready;
  registration = (await navigator.serviceWorker.getRegistration('/')) || registration;
  const scriptUrl = registration?.active?.scriptURL || '';
  if (!registration?.active || !isFcmServiceWorkerUrl(scriptUrl)) {
    throw new Error(
      'firebase-messaging-sw.js 가 활성화되지 않았습니다. PWA를 삭제 후 다시 설치하고, Chrome → Application → Service Workers에서 activated 인지 확인해 주세요.'
    );
  }
  return registration;
}

/** 개발자도구 확인용 */
export async function getFcmServiceWorkerDiagnostics() {
  if (!('serviceWorker' in navigator)) {
    return { ok: false, message: 'Service Worker 미지원 브라우저입니다.' };
  }
  const reg = await navigator.serviceWorker.getRegistration('/');
  const scriptUrl = reg?.active?.scriptURL || reg?.waiting?.scriptURL || '';
  const state = reg?.active?.state || reg?.waiting?.state || 'none';
  const isFcm = isFcmServiceWorkerUrl(scriptUrl);
  return {
    ok: Boolean(reg?.active) && isFcm,
    scriptUrl,
    state,
    isFcmServiceWorker: isFcm,
    message: isFcm
      ? 'firebase-messaging-sw.js 가 활성화되어 있습니다.'
      : 'firebase-messaging-sw.js 가 아닙니다. 푸시 알림을 다시 켜거나 PWA를 재설치해 주세요.'
  };
}

function getOrCreateFirebaseApp(sdk, config) {
  const { initializeApp, getApp, getApps } = sdk;
  return getApps().length ? getApp() : initializeApp(config);
}

async function getFirebaseMessagingContext() {
  const { config, vapidKey } = await fetchFirebaseWebConfig();
  const sdk = await loadFirebaseMessagingSdk();
  const { getMessaging, isSupported } = sdk;
  const supported = await isSupported().catch(() => false);
  if (!supported) return { supported: false };
  const app = getOrCreateFirebaseApp(sdk, config);
  const messaging = getMessaging(app);
  const registration = await ensurePushServiceWorkerRegistration().catch(() => null);
  if (registration) {
    await initFirebaseInServiceWorker(registration, config).catch(() => {});
  }
  return { supported: true, sdk, messaging, config, vapidKey, registration };
}

/** FCM·백엔드·로컬 저장 토큰 제거(재허용 시 새 토큰 발급용) */
export async function clearLocalPushRegistration() {
  const stored = getStoredPushToken();
  const { supported, sdk, messaging } = await getFirebaseMessagingContext().catch(() => ({
    supported: false
  }));
  if (supported && messaging && sdk?.deleteToken) {
    try {
      await sdk.deleteToken(messaging);
    } catch {
      /* ignore */
    }
  }
  if (stored) {
    try {
      await unregisterTokenWithBackend(stored);
    } catch {
      /* ignore */
    }
  }
  setStoredPushToken('');
  setStoredPushOwnerUserId('');
  await writePushSessionMeta('', '');
}

let lastTokenRefreshAt = 0;
const TOKEN_REFRESH_DEBOUNCE_MS = 8000;

export async function getPushNotificationStatus() {
  if (!canUsePushNotifications()) {
    return { supported: false, permission: 'unsupported', registered: false };
  }
  const { isSupported } = await loadFirebaseMessagingSdk();
  const supported = await isSupported().catch(() => false);
  const permission = Notification.permission;
  const stored = getStoredPushToken();
  if (permission !== 'granted' && stored) {
    setStoredPushToken('');
  }
  return {
    supported,
    permission,
    registered: supported && permission === 'granted' && Boolean(stored) && isCrmSessionLoggedIn()
  };
}

/** OS·브라우저에서 알림을 다시 허용했거나 앱 복귀 시 토큰 갱신 */
export async function refreshPushTokenIfGranted(options = {}) {
  if (!canUsePushNotifications()) return { ok: false, skipped: true };
  if (Notification.permission !== 'granted') return { ok: false, skipped: true };
  const forceRefresh = Boolean(options.forceRefresh);
  const now = Date.now();
  if (!forceRefresh && now - lastTokenRefreshAt < TOKEN_REFRESH_DEBOUNCE_MS) {
    return { ok: true, skipped: true };
  }
  lastTokenRefreshAt = now;
  return enablePushNotifications({ forceRefresh });
}

/** @deprecated use getPushNotificationStatus */
export const getCalendarPushStatus = getPushNotificationStatus;

/** 브라우저 알림 권한 변경(설정에서 끄기/다시 허용) 감지 */
export function startPushPermissionWatcher() {
  if (typeof window === 'undefined' || !('permissions' in navigator)) {
    return () => {};
  }
  let permissionStatus = null;
  let cancelled = false;
  const onChange = () => {
    if (cancelled) return;
    if (Notification.permission === 'granted') {
      void refreshPushTokenIfGranted({ forceRefresh: true });
    } else if (Notification.permission === 'denied' || Notification.permission === 'default') {
      void clearLocalPushRegistration().then(() => {
        emitPushStatusChange({
          supported: canUsePushNotifications(),
          permission: Notification.permission,
          registered: false
        });
      });
    }
  };
  navigator.permissions
    .query({ name: 'notifications' })
    .then((status) => {
      if (cancelled) return;
      permissionStatus = status;
      status.addEventListener('change', onChange);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    permissionStatus?.removeEventListener('change', onChange);
  };
}

export async function enablePushNotifications(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  if (!isCrmSessionLoggedIn()) {
    return { ok: false, error: '로그인 후 알림을 켤 수 있습니다.' };
  }
  if (!canUsePushNotifications()) {
    return { ok: false, error: '이 브라우저는 푸시 알림을 지원하지 않습니다.' };
  }
  if (forceRefresh) {
    await clearLocalPushRegistration().catch(() => {});
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
  await withTimeout(
    initFirebaseInServiceWorker(registration, config),
    '푸시 수신 서비스 워커 초기화에 실패했습니다. 앱을 완전히 종료한 뒤 다시 켜 주세요.'
  );
  const token = await withTimeout(
    getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }),
    'FCM 토큰 발급 시간이 초과되었습니다. Firebase 설정과 브라우저 알림 권한을 확인해 주세요.'
  );
  if (!token) return { ok: false, permission, error: '푸시 토큰을 발급받지 못했습니다.' };

  await registerTokenWithBackend(token);
  const ownerUserId = getCurrentCrmUserId();
  setStoredPushToken(token);
  if (ownerUserId) {
    setStoredPushOwnerUserId(ownerUserId);
    await writePushSessionMeta(ownerUserId, getCurrentCrmCompanyId());
  }
  emitPushStatusChange({
    supported: true,
    permission,
    registered: true
  });
  return { ok: true, permission, token };
}

/** @deprecated use enablePushNotifications */
export const enableCalendarPushNotifications = enablePushNotifications;

export async function disablePushNotifications() {
  try {
    await clearLocalPushRegistration();
    emitPushStatusChange({
      supported: canUsePushNotifications(),
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      registered: false
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || '푸시 알림 해제에 실패했습니다.' };
  }
}

export async function bindPushForegroundNotifications(onReceive) {
  if (!canUsePushNotifications()) return null;
  const { getMessaging, isSupported, onMessage } = await loadFirebaseMessagingSdk();
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  try {
    const { config } = await fetchFirebaseWebConfig();
    const registration = await ensurePushServiceWorkerRegistration().catch(() => null);
    if (registration) {
      await initFirebaseInServiceWorker(registration, config).catch(() => {});
    }
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

/** @deprecated use bindPushForegroundNotifications */
export const bindCalendarForegroundNotifications = bindPushForegroundNotifications;

function resolvePushDisplay(payload, defaults = {}) {
  const data = payload?.data || {};
  const notification = payload?.notification || {};
  const title = String(notification.title || data.title || defaults.title || 'Nexvia CRM').trim();
  let body = String(notification.body || data.body || defaults.body || '').trim();
  if (!body) {
    if (data.type === 'announcement') body = '새 공지사항이 등록되었습니다.';
    else if (data.type === 'calendar-reminder') body = '일정 알림이 도착했습니다.';
    else if (data.type === 'lead-capture') body = '새 리드가 수신되었습니다.';
    else body = '탭하여 내용을 확인하세요.';
  }
  const url = data.url || defaults.url || '/notification';
  const tag =
    notification.tag ||
    data.tag ||
    (data.notificationId ? `announcement-${data.notificationId}` : undefined) ||
    (data.eventId ? `calendar-reminder-${data.eventId}` : undefined);
  return { title, body, url, tag, data };
}

/** 앱이 열려 있을 때 수신 — 브라우저 알림으로 표시 (백그라운드는 SW가 동일 형식으로 표시) */
export function showWebPushNotification(payload, defaults = {}) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
  const data = payload?.data || {};
  if (!shouldShowPushForCurrentSession(data)) return null;
  const { title, body, url, tag, data: mergedData } = resolvePushDisplay(payload, defaults);
  const n = new Notification(title, {
    body,
    icon: '/nexvia-app-icon.png',
    tag,
    data: { ...mergedData, url }
  });
  n.onclick = () => {
    window.focus();
    if (url) window.location.assign(url);
  };
  return n;
}
