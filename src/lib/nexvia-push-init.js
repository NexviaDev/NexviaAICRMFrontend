import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let initialized = false;

async function registerDeviceToken(tokenValue) {
  const token = String(tokenValue || '').trim();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/push-notifications/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      credentials: 'include',
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() || 'android' })
    });
  } catch (_) {}
}

async function initWebPushNotifications() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;

  const configRes = await fetch(`${API_BASE}/push-notifications/web-config`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  if (!configRes.ok) return;
  const configData = await configRes.json().catch(() => ({}));
  const c = configData?.config || {};
  if (!c.apiKey || !c.projectId || !c.messagingSenderId || !c.appId || !c.vapidKey) return;

  const [{ initializeApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging')
  ]);

  const supported = await isSupported().catch(() => false);
  if (!supported) return;

  const app = initializeApp({
    apiKey: c.apiKey,
    authDomain: c.authDomain || undefined,
    projectId: c.projectId,
    storageBucket: c.storageBucket || undefined,
    messagingSenderId: c.messagingSenderId,
    appId: c.appId
  }, 'nexvia-web-push');
  const messaging = getMessaging(app);
  const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, { vapidKey: c.vapidKey, serviceWorkerRegistration: swReg }).catch(() => '');
  if (token) await registerDeviceToken(token);
}

export async function initNexviaPushNotifications() {
  if (initialized) return;
  initialized = true;
  const auth = getAuthHeader();
  if (!auth.Authorization) return;
  if (!Capacitor.isNativePlatform()) {
    await initWebPushNotifications();
    return;
  }
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    await PushNotifications.register();
    await PushNotifications.removeAllListeners();

    PushNotifications.addListener('registration', (token) => {
      void registerDeviceToken(token?.value || '');
    });
    PushNotifications.addListener('pushNotificationReceived', () => {});
    PushNotifications.addListener('pushNotificationActionPerformed', () => {});
  } catch (_) {}
}
