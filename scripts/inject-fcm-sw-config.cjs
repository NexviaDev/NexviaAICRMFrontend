/**
 * vite build + injectManifest 이후 dist/firebase-messaging-sw.js 플레이스홀더 치환.
 * VITE_FIREBASE_* 가 없으면 VITE_API_URL 의 web-config API에서 가져옵니다.
 */
const fs = require('fs');
const path = require('path');

const distSw = path.resolve(__dirname, '../dist/firebase-messaging-sw.js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function envValue(key) {
  if (process.env[key] != null && String(process.env[key]).trim() !== '') {
    return String(process.env[key]).trim();
  }
  const root = path.resolve(__dirname, '..');
  return (
    loadEnvFile(path.join(root, '.env.production.local'))[key] ||
    loadEnvFile(path.join(root, '.env.production'))[key] ||
    loadEnvFile(path.join(root, '.env.local'))[key] ||
    loadEnvFile(path.join(root, '.env'))[key] ||
    ''
  );
}

function firebaseConfigFromEnv() {
  return {
    apiKey: envValue('VITE_FIREBASE_WEB_API_KEY'),
    authDomain: envValue('VITE_FIREBASE_WEB_AUTH_DOMAIN'),
    projectId: envValue('VITE_FIREBASE_WEB_PROJECT_ID'),
    storageBucket: envValue('VITE_FIREBASE_WEB_STORAGE_BUCKET'),
    messagingSenderId: envValue('VITE_FIREBASE_WEB_MESSAGING_SENDER_ID'),
    appId: envValue('VITE_FIREBASE_WEB_APP_ID')
  };
}

function normalizeApiConfig(cfg) {
  const c = cfg?.config || cfg || {};
  return {
    apiKey: String(c.apiKey || '').trim(),
    authDomain: String(c.authDomain || '').trim(),
    projectId: String(c.projectId || '').trim(),
    storageBucket: String(c.storageBucket || '').trim(),
    messagingSenderId: String(c.messagingSenderId || '').trim(),
    appId: String(c.appId || '').trim()
  };
}

async function fetchFirebaseConfigFromApi(apiBase) {
  const url = `${apiBase.replace(/\/$/, '')}/push-notifications/web-config`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const json = await res.json();
  return normalizeApiConfig(json);
}

async function main() {
  const apiUrl = envValue('VITE_API_URL').replace(/\/$/, '');
  const apiBase = apiUrl ? `${apiUrl}/api` : '/api';

  let firebaseConfig = firebaseConfigFromEnv();
  if (!firebaseConfig.apiKey && apiBase.startsWith('https://')) {
    console.log('[inject-fcm-sw-config] VITE_FIREBASE_* 없음 → API에서 web-config 조회:', apiBase);
    firebaseConfig = await fetchFirebaseConfigFromApi(apiBase);
  }

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    console.error(
      '[inject-fcm-sw-config] Firebase 설정이 비어 있습니다. Vercel에 VITE_API_URL(백엔드) 또는 VITE_FIREBASE_WEB_* 를 설정하세요.'
    );
    process.exit(1);
  }

  if (!fs.existsSync(distSw)) {
    console.error('[inject-fcm-sw-config] missing', distSw);
    process.exit(1);
  }

  let code = fs.readFileSync(distSw, 'utf8');
  if (!code.includes('__FIREBASE_CONFIG_JSON__') && !code.includes('__NEXVIA_PUSH_API_BASE__')) {
    console.log('[inject-fcm-sw-config] already injected');
    return;
  }

  code = code
    .replace(/__NEXVIA_PUSH_API_BASE__/g, apiBase)
    .replace(/__FIREBASE_CONFIG_JSON__/g, JSON.stringify(firebaseConfig));

  fs.writeFileSync(distSw, code);
  console.log(
    '[inject-fcm-sw-config] ok apiBase=',
    apiBase,
    'projectId=',
    firebaseConfig.projectId
  );
}

main().catch((err) => {
  console.error('[inject-fcm-sw-config] failed', err?.message || err);
  process.exit(1);
});
