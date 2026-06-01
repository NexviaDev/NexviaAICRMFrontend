/**
 * 배포 빌드 ID가 바뀌면 PWA·Workbox 캐시와 SW를 정리한 뒤 1회 새로고침.
 * 서버 /version.json(항상 최신)과 비교 — 옛 JS 번들만 로드된 경우에도 갱신됩니다.
 * crm_token·crm_user 등 로그인 데이터는 건드리지 않습니다.
 */

const BUILD_ID_KEY = 'nexvia_app_build_id';
const RELOAD_GUARD_KEY = 'nexvia_app_build_reload_guard';
const CRM_IN_APP_ROUTE_PREFIXES = [
  '/dashboard',
  '/company-overview',
  '/meeting-minutes',
  '/reports/work-report',
  '/product-list',
  '/kpi',
  '/customer-company-employees',
  '/customer-companies',
  '/sales-pipeline',
  '/map',
  '/lead-capture',
  '/calendar',
  '/project',
  '/todo-list',
  '/ai-voice',
  '/quotation-doc-merge',
  '/subscription',
  '/notification',
  '/email',
  '/messenger',
  '/business-registry',
  '/admin'
];

export function getAppBuildId() {
  return String(import.meta.env.VITE_APP_BUILD_ID || '').trim();
}

/** index.html 인라인 부트스트랩과 동일 — vite transformIndexHtml에서 주입 */
export const APP_BUILD_VERSION_BOOTSTRAP_SNIPPET = `(function(){try{var K='nexvia_app_build_id',G='nexvia_app_build_reload_guard';fetch('/version.json?_='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(d){var id=d&&String(d.buildId||'').trim();if(!id||sessionStorage.getItem(G)===id)return;var s=localStorage.getItem(K);if(s===id)return;sessionStorage.setItem(G,id);localStorage.setItem(K,id);var p=Promise.resolve();if('serviceWorker' in navigator)p=p.then(function(){return navigator.serviceWorker.getRegistrations()}).then(function(regs){return Promise.all(regs.map(function(r){return r.unregister()}))});if('caches' in window)p=p.then(function(){return caches.keys()}).then(function(keys){return Promise.all(keys.map(function(k){return caches.delete(k)}))});p.finally(function(){location.reload()})}).catch(function(){})}catch(e){}})();`;

function shouldLeaveStaleLoginPage() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/login') return false;
  if (localStorage.getItem('crm_token')) return false;

  const params = new URLSearchParams(window.location.search);
  /** OAuth 콜백·약관·오류 표시 등 의미 있는 로그인 URL은 유지 */
  return !params.has('token') && !params.has('needsRegister') && !params.has('legal') && !params.has('error');
}

function shouldRefreshCrmRouteInPlace() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return CRM_IN_APP_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export async function fetchRemoteBuildId() {
  if (import.meta.env.DEV) return '';
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data?.buildId || '').trim();
  } catch {
    return '';
  }
}

export async function purgeStaticCaches() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

/**
 * @returns {Promise<boolean>} true면 곧 location.reload() 되므로 호출 측에서 렌더 중단
 */
export async function ensureAppBuildVersion() {
  if (import.meta.env.DEV) return false;

  const remote = await fetchRemoteBuildId();
  const current = remote || getAppBuildId();
  if (!current) return false;

  const stored = localStorage.getItem(BUILD_ID_KEY);
  if (stored === current) return false;

  /** reload 직후 루프 방지: 같은 빌드로 두 번 purge 하지 않음 */
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === current) {
    localStorage.setItem(BUILD_ID_KEY, current);
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    return false;
  }

  try {
    await purgeStaticCaches();
  } catch (err) {
    console.warn('[nexvia] build cache purge failed', err);
  }

  localStorage.setItem(BUILD_ID_KEY, current);
  sessionStorage.setItem(RELOAD_GUARD_KEY, current);
  if (shouldLeaveStaleLoginPage()) {
    window.location.replace('/');
    await new Promise(() => {});
    return true;
  }
  if (shouldRefreshCrmRouteInPlace()) {
    window.location.replace(window.location.href);
    await new Promise(() => {});
    return true;
  }
  window.location.reload();
  await new Promise(() => {});
  return true;
}
